export const SOCIAL_LOGIN_TESTS_ENV = 'ENABLE_SOCIAL_LOGIN_TESTS';

export function shouldRunSocialLoginTests(): boolean {
    return process.env[SOCIAL_LOGIN_TESTS_ENV] === '1';
}
