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
  background: var(--bg-input, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  color: var(--fg, #c7c7c7);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  resize: vertical;
}
</style>
