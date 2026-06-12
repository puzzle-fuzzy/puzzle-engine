import type { NotificationRow, Serialize } from '@excuse/db'
import type { EntityResponse, ListResponse } from './api-response'

export type NotificationDTO = Serialize<NotificationRow>

export interface NotificationCount {
  count: number
}

export type NotificationListResponse = ListResponse<NotificationDTO>

export type NotificationUnreadCountResponse = EntityResponse<NotificationCount>

export type NotificationReadAllResponse = EntityResponse<NotificationCount>
