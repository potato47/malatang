#import "FIAUpdaterObjC.h"
#import <objc/message.h>

id FIASparkleMakeController(Class controllerClass, id delegate) {
    SEL allocate = sel_registerName("alloc");
    SEL initialize = sel_registerName("initWithStartingUpdater:updaterDelegate:userDriverDelegate:");
    id instance = ((id (*)(id, SEL))objc_msgSend)(controllerClass, allocate);
    return ((id (*)(id, SEL, BOOL, id, id))objc_msgSend)(instance, initialize, YES, delegate, nil);
}

void FIASparkleCheckForUpdates(id controller) {
    SEL selector = sel_registerName("checkForUpdates:");
    ((void (*)(id, SEL, id))objc_msgSend)(controller, selector, nil);
}
