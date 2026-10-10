// Types for the type check (node build.mjs --types): browser features newer than TypeScript's built-in lists,
// and the window properties the page sets on purpose (tests replace functions, workers can be switched off).
declare var ImageDecoder: any;
declare var AudioEncoder: any;
declare var AudioData: any;
interface Window { webkitAudioContext?: any; launchQueue?: any; __noWorkers?: boolean; [name: string]: any }
