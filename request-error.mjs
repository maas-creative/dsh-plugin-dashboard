// Classification only; provider bodies never enter the ledger.
export function requestErrorDetails(e){return {...(Number.isInteger(e?.statusCode)?{statusCode:e.statusCode}:{}),...(typeof e?.isRetryable==='boolean'?{isRetryable:e.isRetryable}:{})}}
export function requestError(message,details){return Object.assign(new Error(message),requestErrorDetails(details))}
