#include "FIAProcessSupport.h"
#include <spawn.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <sys/wait.h>
#include <libproc.h>
#include <stdlib.h>

int fia_spawn(const char *exe, char *const argv[], char *const env[], const char *cwd, pid_t *pid, int *input, int *output, int *error) {
    int fds[3][2] = {{-1,-1},{-1,-1},{-1,-1}};
    int result = 0;
    for (int i=0; i<3; i++) {
        if (pipe(fds[i])) { result = errno; goto done; }
    }
    posix_spawn_file_actions_t actions;
    posix_spawnattr_t attr;
    result = posix_spawn_file_actions_init(&actions);
    if (result) goto done;
    result = posix_spawnattr_init(&attr);
    if (result) { posix_spawn_file_actions_destroy(&actions); goto done; }
    if (!(result = posix_spawn_file_actions_adddup2(&actions, fds[0][0], 0)) &&
        !(result = posix_spawn_file_actions_adddup2(&actions, fds[1][1], 1)) &&
        !(result = posix_spawn_file_actions_adddup2(&actions, fds[2][1], 2)) &&
        !(result = posix_spawn_file_actions_addchdir_np(&actions, cwd)) &&
        !(result = posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT)) &&
        !(result = posix_spawnattr_setpgroup(&attr, 0))) {
        result = posix_spawn(pid, exe, &actions, &attr, argv, env);
    }
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attr);
    if (!result) {
        *input = fds[0][1]; fds[0][1] = -1;
        *output = fds[1][0]; fds[1][0] = -1;
        *error = fds[2][0]; fds[2][0] = -1;
        fcntl(*input, F_SETFL, O_NONBLOCK);
        fcntl(*input, F_SETNOSIGPIPE, 1);
    }
done:
    for (int i=0;i<3;i++) for(int j=0;j<2;j++) if(fds[i][j]>=0) close(fds[i][j]);
    return result;
}
uint64_t fia_process_identity(pid_t pid) {
    struct proc_bsdinfo info;
    if(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) return 0;
    if(info.pbi_uid != getuid() || info.pbi_pgid != (uint32_t)pid) return 0;
    return info.pbi_start_tvsec * 1000000ULL + info.pbi_start_tvusec;
}
int fia_group_state(pid_t pid, uint64_t identity) {
    if(pid <= 1) return -1;
    if(kill(-pid, 0) < 0) return errno == ESRCH ? 0 : -1;
    if(!identity) return -1;
    // A reused leader PID must never authorize a signal to an unrelated group.
    struct proc_bsdinfo leader;
    if(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &leader, sizeof(leader)) == sizeof(leader)) {
        uint64_t actual = leader.pbi_start_tvsec * 1000000ULL + leader.pbi_start_tvusec;
        if(actual != identity || leader.pbi_uid != getuid() || leader.pbi_pgid != (uint32_t)pid) return -1;
    } else if(kill(pid, 0) == 0 || errno != ESRCH) {
        return -1;
    }
    int count = proc_listpids(PROC_PGRP_ONLY, (uint32_t)pid, NULL, 0);
    if(count <= 0) return kill(-pid,0) < 0 && errno == ESRCH ? 0 : -1;
    int capacity = count + 64 * sizeof(pid_t);
    pid_t *members = calloc(1, capacity);
    if(!members) return -1;
    int bytes = proc_listpids(PROC_PGRP_ONLY, (uint32_t)pid, members, capacity);
    int owned = bytes > 0 && bytes < capacity;
    for(int i=0; owned && i<bytes/(int)sizeof(pid_t); i++) {
        if(!members[i]) continue;
        struct proc_bsdinfo info;
        if(proc_pidinfo(members[i], PROC_PIDTBSDINFO, 0, &info, sizeof(info)) == sizeof(info)) {
            if(info.pbi_uid != getuid() || info.pbi_pgid != (uint32_t)pid) owned = 0;
        } else if(kill(members[i], 0) == 0 || errno != ESRCH) {
            owned = 0;
        }
    }
    free(members);
    return owned ? 1 : -1;
}
int fia_signal_group(pid_t pid, uint64_t identity, int signal) {
    int state = fia_group_state(pid, identity);
    if(state == 0) return 0;
    if(state != 1) return EPERM;
    return kill(-pid,signal) == 0 || errno == ESRCH ? 0 : errno;
}
int fia_wait(pid_t pid) {
    int status;
    while(waitpid(pid,&status,0)<0) if(errno != EINTR) return -1;
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
