import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/knowledge-bases',
  },
  {
    path: '/knowledge-bases',
    name: 'knowledge-bases',
    component: () => import('../views/KnowledgeBaseListView.vue'),
  },
  {
    path: '/knowledge-bases/:id',
    name: 'knowledge-base-detail',
    component: () => import('../views/KnowledgeBaseDetailView.vue'),
    props: (route) => ({
      id: Number(route.params.id),
    }),
  },
  {
    path: '/knowledge-bases/:id/chat',
    name: 'chat-placeholder',
    component: () => import('../views/ChatPlaceholderView.vue'),
    props: (route) => ({
      knowledgeBaseId: Number(route.params.id),
    }),
  },
  {
    path: '/health',
    name: 'health',
    component: () => import('../views/HomePage.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
