const chatUrl = import.meta.env.VITE_CHAT_URL;

export interface AdminSession {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  rating: number | null;
  comment: string | null;
  phenotypeCode: string | null;
  messageCount: number;
  preview: string | null;
}

export interface AdminSessionListResponse {
  sessions: AdminSession[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  thumbsUp: boolean | null;
}

export interface AdminSessionDetail {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  rating: number | null;
  comment: string | null;
  phenotypeCode: string | null;
  messages: AdminMessage[];
}

export interface UsageDataPoint {
  date: string;
  unique_users: number;
  conversations: number;
}

export interface UsageAnalyticsResponse {
  period: string;
  data: UsageDataPoint[];
}

export interface AdminSessionFilters {
  user?: string;
  dateFrom?: string;
  dateTo?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
}

export async function fetchAdminSessions(
  filters: AdminSessionFilters = {}
): Promise<AdminSessionListResponse> {
  const params = new URLSearchParams();
  if (filters.user) params.set("user", filters.user);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.sessionId) params.set("session_id", filters.sessionId);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));

  const response = await fetch(`${chatUrl}/v1/admin/sessions?${params}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    sessions: data.sessions.map(mapSession),
    total: data.total,
    limit: data.limit,
    offset: data.offset,
  };
}

export async function fetchAdminSessionDetail(
  sessionId: string
): Promise<AdminSessionDetail> {
  const response = await fetch(`${chatUrl}/v1/admin/sessions/${sessionId}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    id: data.id,
    userId: data.user_id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    rating: data.rating,
    comment: data.comment,
    phenotypeCode: data.phenotype_code,
    messages: data.messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      thumbsUp: m.thumbs_up,
    })),
  };
}

export async function fetchUsageAnalytics(
  period: "week" | "month" | "year" = "week"
): Promise<UsageAnalyticsResponse> {
  const response = await fetch(`${chatUrl}/v1/admin/analytics/usage?period=${period}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function mapSession(data: any): AdminSession {
  return {
    id: data.id,
    userId: data.user_id,
    title: data.title,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    rating: data.rating,
    comment: data.comment,
    phenotypeCode: data.phenotype_code,
    messageCount: data.message_count,
    preview: data.preview,
  };
}
