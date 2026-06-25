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
  disposition: string | null;
  issueCount: number;
  issueCategories: string[];
  llmRating: number | null;
  successLabel: string | null;
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

// raw per-conversation row from /admin/analytics/quality; aggregated client-side
// into plot series in the Quality plots tab (task .10)
export interface QualityRow {
  sessionId: string;
  createdAt: string;
  llmQualityScore: number | null;
  llmDisposition: string | null;
  successLabel: string | null;
  issueCategories: string[];
}

export interface FeedbackItem {
  user: string;
  comment: string;
  preview: string;
  createdAt: string;
  source: "feedback_dialog" | "session_comment";
  sessionId: string | null;
}

export interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  latestAt: string | null;
  limit: number;
  offset: number;
}

export interface AdminSessionFilters {
  user?: string;
  dateFrom?: string;
  dateTo?: string;
  sessionId?: string;
  disposition?: string;
  successLabel?: string;
  minIssues?: number;
  // string so 'NA' (unrated) and '1'..'5' can both be expressed
  rating?: string;
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
  if (filters.disposition) params.set("disposition", filters.disposition);
  if (filters.successLabel) params.set("success_label", filters.successLabel);
  if (filters.minIssues != null) params.set("min_issues", String(filters.minIssues));
  if (filters.rating) params.set("rating", filters.rating);
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

export async function fetchQualitySeries(): Promise<QualityRow[]> {
  const response = await fetch(`${chatUrl}/v1/admin/analytics/quality`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data.rows ?? []).map(mapQualityRow);
}

function mapQualityRow(data: any): QualityRow {
  return {
    sessionId: data.session_id,
    createdAt: data.created_at,
    llmQualityScore: data.llm_quality_score ?? null,
    llmDisposition: data.llm_disposition ?? null,
    successLabel: data.success_label ?? null,
    issueCategories: data.issue_categories ?? [],
  };
}

export async function fetchAdminFeedback(
  params: { limit?: number; offset?: number } = {}
): Promise<FeedbackListResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit != null) searchParams.set("limit", String(params.limit));
  if (params.offset != null) searchParams.set("offset", String(params.offset));

  const response = await fetch(`${chatUrl}/v1/admin/feedback?${searchParams}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    items: data.items.map(mapFeedbackItem),
    total: data.total,
    latestAt: data.latest_at,
    limit: data.limit,
    offset: data.offset,
  };
}

function mapFeedbackItem(data: any): FeedbackItem {
  return {
    user: data.user,
    comment: data.comment,
    preview: data.preview,
    createdAt: data.created_at,
    source: data.source,
    sessionId: data.session_id,
  };
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
    disposition: data.disposition ?? null,
    issueCount: data.issue_count ?? 0,
    issueCategories: data.issue_categories ?? [],
    llmRating: data.llm_rating ?? null,
    successLabel: data.success_label ?? null,
  };
}
