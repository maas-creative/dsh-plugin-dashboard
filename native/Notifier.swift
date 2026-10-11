import AppKit
import UserNotifications
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let center = UNUserNotificationCenter.current()
class Presenter: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completion: @escaping (UNNotificationPresentationOptions)->Void) { completion([.banner,.list,.sound]) }
}
let presenter=Presenter()
center.delegate=presenter
func finish(_ value: [String:Any]) { if let data = try? JSONSerialization.data(withJSONObject:value), let line = String(data:data,encoding:.utf8) { print(line) }; exit(0) }
let args = CommandLine.arguments
center.getNotificationSettings { settings in
    if args.contains("--delivered") { center.getDeliveredNotifications { items in finish(["ids":items.map { $0.request.identifier }]) }; return }
    if args.contains("--status") { finish(["authorization":settings.authorizationStatus.rawValue]) }
    func send() {
        guard args.count >= 4 else { finish(["error":"missing arguments"]); return }
        let content=UNMutableNotificationContent(); content.title=args[1]; content.body=args[2]; content.sound = .default
        center.add(UNNotificationRequest(identifier:args[3],content:content,trigger:UNTimeIntervalNotificationTrigger(timeInterval:1,repeats:false))) { error in
            if let error=error { finish(["error":error.localizedDescription]) } else {
                DispatchQueue.main.asyncAfter(deadline:.now()+3) {
                    center.getDeliveredNotifications { items in finish(["accepted":true,"recorded":items.contains { $0.request.identifier == args[3] }]) }
                }
            }
        }
    }
    if settings.authorizationStatus == .notDetermined {
        center.requestAuthorization(options:[.alert,.sound,.badge]) { allowed,error in
            if allowed { send() } else { finish(["error":error?.localizedDescription ?? "通知が許可されていません"]) }
        }
    } else if settings.authorizationStatus == .denied { finish(["error":"macOSで通知が拒否されています"]) }
    else { send() }
}
DispatchQueue.global().asyncAfter(deadline:.now()+25) { finish(["error":"通知の応答がありません"]) }
app.run()
