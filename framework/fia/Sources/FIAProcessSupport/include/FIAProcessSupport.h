#include <stdint.h>
#include <sys/types.h>
int fia_spawn(const char *exe, char *const argv[], char *const env[], const char *cwd, pid_t *pid, int *input, int *output, int *error);
uint64_t fia_process_identity(pid_t pid);
// 0 absent, 1 owned, -1 ownership cannot be established.
int fia_group_state(pid_t pid, uint64_t identity);
int fia_signal_group(pid_t pid, uint64_t identity, int signal);
int fia_wait(pid_t pid);
