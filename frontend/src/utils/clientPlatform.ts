export const isWindowsClient: boolean =
  typeof navigator !== 'undefined' &&
  /Win/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform,
  )
