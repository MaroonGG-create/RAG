import { createRouter, createWebHistory } from 'vue-router'
import type { LocationQueryValue, RouteRecordRaw } from 'vue-router'

function getRouteNumber(value: LocationQueryValue | LocationQueryValue[]): number | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value

  if (rawValue === null || rawValue === undefined || rawValue.trim().length === 0) {
    return undefined
  }

  const id = Number(rawValue)

  return Number.isInteger(id) && id > 0 ? id : undefined
}

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
    name: 'knowledge-base-chat',
    component: () => import('../views/ChatView.vue'),
    props: (route) => ({
      knowledgeBaseId: Number(route.params.id),
      conversationId: getRouteNumber(route.query.conversationId),
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
