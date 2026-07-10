import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')
const originalUserAgentData = Object.getOwnPropertyDescriptor(navigator, 'userAgentData')

function setNavigatorPlatform(options: { userAgentDataPlatform?: string; platform: string }) {
  if (options.userAgentDataPlatform === undefined) {
    delete (navigator as Navigator & { userAgentData?: unknown }).userAgentData
  } else {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { platform: options.userAgentDataPlatform },
    })
  }
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: options.platform,
  })
}

function restoreNavigatorProperty(
  name: 'platform' | 'userAgentData',
  descriptor?: PropertyDescriptor
) {
  delete (navigator as any)[name]
  if (descriptor) Object.defineProperty(navigator, name, descriptor)
}

async function loadIsWindowsClient(options: { userAgentDataPlatform?: string; platform: string }) {
  vi.resetModules()
  setNavigatorPlatform(options)
  return (await import('../utils/clientPlatform')).isWindowsClient
}

describe('clientPlatform', () => {
  afterEach(() => {
    vi.resetModules()
  })

  afterAll(() => {
    restoreNavigatorProperty('platform', originalPlatform)
    restoreNavigatorProperty('userAgentData', originalUserAgentData)
  })

  // 验证 userAgentData.platform 优先用于 Windows 客户端判断。
  it('detects Windows from navigator.userAgentData.platform before navigator.platform', async () => {
    await expect(
      loadIsWindowsClient({ userAgentDataPlatform: 'Windows', platform: 'MacIntel' })
    ).resolves.toBe(true)
  })

  // 验证缺少 userAgentData.platform 时会回退到 navigator.platform。
  it('falls back to navigator.platform when userAgentData.platform is missing', async () => {
    await expect(loadIsWindowsClient({ platform: 'Win32' })).resolves.toBe(true)
  })

  // 验证 userAgentData.platform 存在时不会被 navigator.platform 覆盖。
  it('does not use navigator.platform when userAgentData.platform is available', async () => {
    await expect(
      loadIsWindowsClient({ userAgentDataPlatform: 'macOS', platform: 'Win32' })
    ).resolves.toBe(false)
  })

  // 验证非 Windows 平台不会被误判为 Windows 客户端。
  it('returns false for non-Windows platforms', async () => {
    await expect(loadIsWindowsClient({ platform: 'Linux x86_64' })).resolves.toBe(false)
  })
})
