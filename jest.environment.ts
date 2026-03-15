/**
 * Custom Jest environment that extends jest-environment-jsdom with
 * Node fetch API globals required by MSW v2.
 */
import JsDomEnvironment from 'jest-environment-jsdom'
import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment'

export default class CustomTestEnvironment extends JsDomEnvironment {
  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    // Override customExportConditions to prevent jsdom from resolving browser builds.
    // This is needed for MSW v2 which has node-specific interceptors.
    const updatedConfig = {
      ...config,
      projectConfig: {
        ...config.projectConfig,
        testEnvironmentOptions: {
          ...config.projectConfig.testEnvironmentOptions,
          customExportConditions: [''],
        },
      },
    }
    super(updatedConfig, context)
  }

  async setup() {
    await super.setup()

    // MSW v2 requires fetch globals that jsdom doesn't provide.
    // Copy them from Node's global scope.
    if (typeof this.global.Response === 'undefined') {
      // These are available in Node 18+ as globals
      const nodeGlobals = globalThis as Record<string, unknown>
      this.global.fetch = nodeGlobals.fetch as typeof fetch
      this.global.Response = nodeGlobals.Response as typeof Response
      this.global.Request = nodeGlobals.Request as typeof Request
      this.global.Headers = nodeGlobals.Headers as typeof Headers
      this.global.FormData = nodeGlobals.FormData as typeof FormData
    }
  }
}
