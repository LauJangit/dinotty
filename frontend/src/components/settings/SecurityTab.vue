<template>
  <div>
    <!-- Auth config -->
    <section class="settings-section">
      <h3>{{ t('security.authConfig') }}</h3>

      <div class="settings-group">
        <h3 class="settings-group-title">{{ t('security.allowedOrigins') }}</h3>
        <textarea
          class="config-textarea"
          :value="settings.auth.allowed_origins.join('\n')"
          @input="onAllowedOriginsInput"
          :placeholder="t('security.allowedOriginsPlaceholder')"
          rows="3"
        ></textarea>
        <p class="settings-hint">{{ t('security.allowedOriginsHint') }}</p>
      </div>

      <div class="settings-group">
        <h3 class="settings-group-title">{{ t('security.trustedProxies') }}</h3>
        <textarea
          class="config-textarea"
          :value="settings.auth.trusted_proxies.join('\n')"
          @input="onTrustedProxiesInput"
          :placeholder="t('security.trustedProxiesPlaceholder')"
          rows="3"
        ></textarea>
        <p class="settings-hint">{{ t('security.trustedProxiesHint') }}</p>
      </div>

      <div class="settings-group">
        <div class="settings-row">
          <label>{{ t('security.lockoutStrategy') }}</label>
          <select v-model="settings.auth.lockout_strategy" @change="saveSettings()">
            <option value="ip">IP</option>
            <option value="global">Global</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>

      <div class="settings-group" v-if="settings.auth.lockout_strategy === 'ip'">
        <div class="settings-row">
          <label>{{ t('security.lockoutMaxFailures') }}</label>
          <input
            type="number"
            v-model.number="settings.auth.lockout_max_failures"
            @change="saveSettings()"
            min="1"
            max="100"
            class="settings-input-number"
          />
        </div>
        <div class="settings-row">
          <label>{{ t('security.lockoutSecs') }}</label>
          <input
            type="number"
            v-model.number="settings.auth.lockout_secs"
            @change="saveSettings()"
            min="10"
            max="3600"
            class="settings-input-number"
          />
        </div>
      </div>

      <div class="settings-group" v-if="settings.auth.lockout_strategy === 'global'">
        <div class="settings-row">
          <label>{{ t('security.globalLockoutMaxFailures') }}</label>
          <input
            type="number"
            v-model.number="settings.auth.global_lockout_max_failures"
            @change="saveSettings()"
            min="1"
            max="1000"
            class="settings-input-number"
          />
        </div>
        <div class="settings-row">
          <label>{{ t('security.globalLockoutSecs') }}</label>
          <input
            type="number"
            v-model.number="settings.auth.global_lockout_secs"
            @change="saveSettings()"
            min="10"
            max="86400"
            class="settings-input-number"
          />
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-row">
          <label>{{ t('security.previewAllowExternal') }}</label>
          <label class="toggle">
            <input type="checkbox" v-model="settings.preview.allow_external" @change="saveSettings()" />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
        <p class="settings-hint">{{ t('security.previewAllowExternalHint') }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'

const { settings, saveSettings } = useSettings()
const { t } = useI18n()

function onAllowedOriginsInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  settings.auth.allowed_origins = val.split('\n').map((s) => s.trim()).filter(Boolean)
  saveSettings()
}

function onTrustedProxiesInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  settings.auth.trusted_proxies = val.split('\n').map((s) => s.trim()).filter(Boolean)
  saveSettings()
}
</script>

<style scoped>
.config-textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  resize: vertical;
}
.settings-input-number {
  width: 80px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  padding: 6px 8px;
  font-size: 12px;
  text-align: center;
}
</style>
