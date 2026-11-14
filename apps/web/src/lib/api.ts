import type {
  AssetDto,
  AssetUrlResponse,
  AuthResponse,
  CreateInviteDto,
  CreateProjectDto,
  CreateUploadUrlDto,
  CreateWorkspaceDto,
  InviteResponse,
  LoginDto,
  MeResponse,
  ProjectDetailResponse,
  ProjectMemberDto,
  ProjectSummary,
  RealtimeTicketResponse,
  RegisterDto,
  UpdateMemberRoleDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpdateWorkspaceDto,
  UploadUrlResponse,
  WorkspaceMemberDto,
  WorkspaceSummary,
} from '@nova/shared';

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class NovaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'NovaApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  skipAuthRefresh?: boolean;
}

export class NovaApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;
  private readonly baseUrlResolver: () => string;
  private readonly fetchImpl: typeof fetch;
  private onUnauthenticated?: () => void;

  constructor(options?: {
    baseUrl?: string | (() => string);
    fetchImpl?: typeof fetch;
    onUnauthenticated?: () => void;
  }) {
    const base = options?.baseUrl;
    this.baseUrlResolver =
      typeof base === 'function'
        ? base
        : () => base ?? process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.onUnauthenticated = options?.onUnauthenticated;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  setOnUnauthenticated(handler: (() => void) | undefined): void {
    this.onUnauthenticated = handler;
  }

  clearSession(): void {
    this.accessToken = null;
  }

  private buildUrl(path: string): string {
    const base = this.baseUrlResolver().replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  async refreshAccessToken(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const res = await this.fetchImpl(this.buildUrl('/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          this.accessToken = null;
          return null;
        }
        const payload = (await res.json()) as { accessToken?: unknown };
        if (typeof payload.accessToken === 'string' && payload.accessToken.length > 0) {
          this.accessToken = payload.accessToken;
          return payload.accessToken;
        }
        this.accessToken = null;
        return null;
      } catch {
        this.accessToken = null;
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { headers = {}, skipAuthRefresh = false, body, ...rest } = options;

    const runFetch = (token: string | null): Promise<Response> => {
      const mergedHeaders: Record<string, string> = {
        Accept: 'application/json',
        ...headers,
      };
      if (body !== undefined && !mergedHeaders['Content-Type'] && !(body instanceof FormData)) {
        mergedHeaders['Content-Type'] = 'application/json';
      }
      if (token) {
        mergedHeaders.Authorization = `Bearer ${token}`;
      }
      return this.fetchImpl(this.buildUrl(path), {
        ...rest,
        body,
        headers: mergedHeaders,
        credentials: 'include',
      });
    };

    let response = await runFetch(this.accessToken);

    if (response.status === 401 && !skipAuthRefresh) {
      const nextToken = await this.refreshAccessToken();
      if (nextToken) {
        response = await runFetch(nextToken);
      } else {
        this.onUnauthenticated?.();
      }
    }

    if (!response.ok) {
      let parsed: ApiErrorBody | undefined;
      try {
        parsed = (await response.json()) as ApiErrorBody;
      } catch {
        parsed = undefined;
      }
      const code = parsed?.error?.code ?? `HTTP_${response.status}`;
      const message = parsed?.error?.message ?? `Request failed (${response.status})`;
      throw new NovaApiError(response.status, code, message, parsed?.error?.details);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(dto),
      skipAuthRefresh: true,
    });
    this.accessToken = data.accessToken;
    return data;
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const data = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(dto),
      skipAuthRefresh: true,
    });
    this.accessToken = data.accessToken;
    return data;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>('/auth/logout', {
        method: 'POST',
        skipAuthRefresh: true,
      });
    } finally {
      this.accessToken = null;
    }
  }

  async getMe(): Promise<MeResponse> {
    return this.request<MeResponse>('/me', { method: 'GET' });
  }

  async createWorkspace(dto: CreateWorkspaceDto): Promise<{ workspace: WorkspaceSummary }> {
    return this.request<{ workspace: WorkspaceSummary }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async getWorkspace(id: string): Promise<{ workspace: WorkspaceSummary }> {
    return this.request<{ workspace: WorkspaceSummary }>(`/workspaces/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
  }

  async updateWorkspace(
    id: string,
    dto: UpdateWorkspaceDto,
  ): Promise<{ workspace: WorkspaceSummary }> {
    return this.request<{ workspace: WorkspaceSummary }>(`/workspaces/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  }

  async listWorkspaceMembers(workspaceId: string): Promise<{ members: WorkspaceMemberDto[] }> {
    return this.request<{ members: WorkspaceMemberDto[] }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/members`,
      { method: 'GET' },
    );
  }

  async updateWorkspaceMemberRole(
    workspaceId: string,
    userId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<{ member: WorkspaceMemberDto }> {
    return this.request<{ member: WorkspaceMemberDto }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
      },
    );
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    return this.request<void>(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }

  async createWorkspaceInvite(
    workspaceId: string,
    dto: CreateInviteDto,
  ): Promise<InviteResponse> {
    return this.request<InviteResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/invites`,
      {
        method: 'POST',
        body: JSON.stringify(dto),
      },
    );
  }

  async acceptInvite(token: string): Promise<{ workspace: WorkspaceSummary }> {
    return this.request<{ workspace: WorkspaceSummary }>(
      `/invites/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    );
  }

  async listProjects(
    workspaceId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ projects: ProjectSummary[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<{ projects: ProjectSummary[]; nextCursor: string | null }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/projects${qs ? `?${qs}` : ''}`,
      { method: 'GET' },
    );
  }

  async createProject(
    workspaceId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectDetailResponse> {
    return this.request<ProjectDetailResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/projects`,
      {
        method: 'POST',
        body: JSON.stringify(dto),
      },
    );
  }

  async getProject(projectId: string): Promise<ProjectDetailResponse> {
    return this.request<ProjectDetailResponse>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'GET',
    });
  }

  async updateProject(
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDetailResponse> {
    return this.request<ProjectDetailResponse>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.request<void>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
  }

  async duplicateProject(projectId: string): Promise<ProjectDetailResponse> {
    return this.request<ProjectDetailResponse>(
      `/projects/${encodeURIComponent(projectId)}/duplicate`,
      { method: 'POST' },
    );
  }

  async issueRealtimeTicket(projectId: string): Promise<RealtimeTicketResponse> {
    return this.request<RealtimeTicketResponse>(
      `/projects/${encodeURIComponent(projectId)}/realtime-ticket`,
      { method: 'POST' },
    );
  }

  async listProjectMembers(projectId: string): Promise<ProjectMemberDto[]> {
    return this.request<ProjectMemberDto[]>(
      `/projects/${encodeURIComponent(projectId)}/members`,
      { method: 'GET' },
    );
  }

  async setProjectMemberRole(
    projectId: string,
    userId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<ProjectMemberDto> {
    return this.request<ProjectMemberDto>(
      `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(dto),
      },
    );
  }

  async clearProjectMemberOverride(projectId: string, userId: string): Promise<void> {
    return this.request<void>(
      `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }

  async createAssetUploadUrl(
    projectId: string,
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponse> {
    return this.request<UploadUrlResponse>(
      `/projects/${encodeURIComponent(projectId)}/assets/upload-url`,
      {
        method: 'POST',
        body: JSON.stringify(dto),
      },
    );
  }

  async confirmAsset(assetId: string): Promise<{ asset: AssetDto }> {
    return this.request<{ asset: AssetDto }>(
      `/assets/${encodeURIComponent(assetId)}/confirm`,
      { method: 'POST' },
    );
  }

  async listProjectAssets(projectId: string): Promise<{ assets: AssetDto[] }> {
    return this.request<{ assets: AssetDto[] }>(
      `/projects/${encodeURIComponent(projectId)}/assets`,
    );
  }

  async getAssetUrl(assetId: string): Promise<AssetUrlResponse> {
    return this.request<AssetUrlResponse>(
      `/assets/${encodeURIComponent(assetId)}/url`,
    );
  }
}

export const apiClient = new NovaApiClient();
