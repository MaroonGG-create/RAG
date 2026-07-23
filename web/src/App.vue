<script setup lang="ts">
import HomePage from './views/HomePage.vue'
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>RAG 知识库</h1>
    </header>
    <main class="app-content">
      <HomePage />
    </main>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: #f5f5f5;
  color: rgba(0, 0, 0, 0.88);
}

.app-header {
  padding: 16px 24px;
  background: #001529;
  color: #fff;
}

.app-header h1 {
  margin: 0;
  font-size: 20px;
}

.app-content {
  width: min(960px, 100%);
  margin: 0 auto;
  padding: 32px 24px;
}
</style>
