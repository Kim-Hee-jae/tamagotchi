import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("VAPID keys generated.");
console.log("");
console.log("publicKey:");
console.log(keys.publicKey);
console.log("");
console.log("privateKey:");
console.log(keys.privateKey);
console.log("");
console.log("Put publicKey in private_config.txt or app/main_pwa/config.txt.");
console.log("Put privateKey only in private_config.txt or Render Secret File.");
