export type ShareScope = 'private' | 'team' | 'org';

export const DEFAULT_SHARE_POLICY: Record<string, ShareScope> = {
    审批倾向: 'private',
    专注时间段: 'private',
    社交图谱: 'private',
    踩过的坑: 'private',
    技能图谱: 'team',
    当前工作上下文: 'team',
    常用命令模式: 'team',
    个人最佳实践: 'team',
    基本信息: 'org',
    认证与资质: 'org',
};

export function buildPersonalResourceId(employeeId: string): string {
    return `employee-${employeeId}`;
}

export function buildTeamResourceId(teamName: string): string {
    return `team-${teamName}`;
}

export function buildOrgResourceId(orgName: string): string {
    return `org-${orgName}`;
}

export function parseResourceScope(resourceId: string): ShareScope {
    if (resourceId.startsWith('org-')) {
        return 'org';
    }
    if (resourceId.startsWith('team-')) {
        return 'team';
    }
    return 'private';
}
