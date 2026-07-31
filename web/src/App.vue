<script setup lang="ts">
import {
  Layout,
  LayoutContent,
  LayoutHeader,
} from 'ant-design-vue'
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <Layout class="app-shell">
    <LayoutHeader class="app-header">
      <RouterLink class="app-brand" to="/knowledge-bases">
        RAG 知识库
      </RouterLink>
      <nav class="app-nav" aria-label="主导航">
        <RouterLink to="/knowledge-bases">知识库</RouterLink>
        <RouterLink to="/health">健康检查</RouterLink>
      </nav>
    </LayoutHeader>
    <LayoutContent class="app-content">
      <RouterView />
    </LayoutContent>
  </Layout>
</template>

<style>
* {
  box-sizing: border-box;
}

html,
body,
#app {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
}

body {
  background: #f5f7fb;
  color: rgba(0, 0, 0, 0.88);
}

.app-shell {
  min-height: 100vh;
  background: #f5f7fb;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 32px;
  height: 56px;
  padding: 0 24px;
  background: #172033;
}

.app-brand {
  flex: 0 0 auto;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  text-decoration: none;
}

.app-brand:hover {
  color: #fff;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.app-nav a {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.72);
  text-decoration: none;
}

.app-nav a:hover,
.app-nav a.router-link-active {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}

.app-content {
  width: min(1180px, 100%);
  margin: 0 auto;
  padding: 24px;
}

@media (max-width: 640px) {
  .app-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    height: auto;
    padding: 12px 16px;
  }

  .app-nav {
    width: 100%;
  }

  .app-nav a {
    padding: 0 10px;
  }

  .app-content {
    padding: 16px;
  }
}
</style>
