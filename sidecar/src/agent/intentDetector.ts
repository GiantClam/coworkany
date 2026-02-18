/**
 * Intent Detector
 *
 * Analyzes LLM thoughts/plans and tool actions to detect task intent.
 * Used to determine if a task may require suspension (e.g., authentication, user input).
 */

export interface TaskIntent {
    type: 'browser_automation' | 'command_execution' | 'file_operation' | 'network_request' | 'general';
    requiresAuthentication?: boolean;
    requiresUserInput?: boolean;
    requiresExternalApp?: boolean;
    estimatedWaitType?: 'none' | 'short' | 'long' | 'user_dependent';
    confidence: number; // 0-1
}

export class IntentDetector {
    /**
     * Detect intent from LLM thought/reasoning and the action to be executed
     */
    detectIntent(thought: string, action: { tool: string; args: any }): TaskIntent {
        const thoughtLower = thought.toLowerCase();
        const tool = action.tool;

        // Browser automation intent
        if (this.isBrowserAutomation(tool, thoughtLower)) {
            return this.detectBrowserIntent(thoughtLower, action.args);
        }

        // Command execution intent
        if (this.isCommandExecution(tool)) {
            return this.detectCommandIntent(thoughtLower, action.args);
        }

        // File operation intent
        if (this.isFileOperation(tool)) {
            return this.detectFileIntent(thoughtLower, action.args);
        }

        // Network request intent
        if (this.isNetworkRequest(tool)) {
            return this.detectNetworkIntent(thoughtLower, action.args);
        }

        // Default: general intent
        return {
            type: 'general',
            requiresAuthentication: false,
            requiresUserInput: false,
            requiresExternalApp: false,
            estimatedWaitType: 'none',
            confidence: 0.5,
        };
    }

    // ============================================================================
    // Tool Category Detection
    // ============================================================================

    private isBrowserAutomation(tool: string, thought: string): boolean {
        return tool.startsWith('browser_') ||
               thought.includes('browse') ||
               thought.includes('web page') ||
               thought.includes('website');
    }

    private isCommandExecution(tool: string): boolean {
        return tool === 'execute_command' ||
               tool === 'bash' ||
               tool === 'shell' ||
               tool === 'run_script';
    }

    private isFileOperation(tool: string): boolean {
        return tool === 'read_file' ||
               tool === 'write_file' ||
               tool === 'edit_file' ||
               tool === 'delete_file';
    }

    private isNetworkRequest(tool: string): boolean {
        return tool === 'fetch_url' ||
               tool === 'api_call' ||
               tool === 'http_request';
    }

    // ============================================================================
    // Specific Intent Detection
    // ============================================================================

    private detectBrowserIntent(thought: string, args: any): TaskIntent {
        const url = args.url || '';
        const requiresAuth = this.detectAuthNeed(thought, url);

        return {
            type: 'browser_automation',
            requiresAuthentication: requiresAuth,
            requiresUserInput: false,
            requiresExternalApp: false,
            estimatedWaitType: requiresAuth ? 'user_dependent' : 'short',
            confidence: 0.9,
        };
    }

    private detectCommandIntent(thought: string, args: any): TaskIntent {
        const command = args.command || args.script || '';
        const commandStr = typeof command === 'string' ? command : '';

        const isInteractive = this.detectInteractiveCommand(commandStr);
        const launchesApp = this.detectExternalApp(commandStr);

        return {
            type: 'command_execution',
            requiresAuthentication: this.detectSudoCommand(commandStr),
            requiresUserInput: isInteractive,
            requiresExternalApp: launchesApp,
            estimatedWaitType: isInteractive || launchesApp ? 'user_dependent' : 'short',
            confidence: 0.85,
        };
    }

    private detectFileIntent(thought: string, args: any): TaskIntent {
        return {
            type: 'file_operation',
            requiresAuthentication: false,
            requiresUserInput: false,
            requiresExternalApp: false,
            estimatedWaitType: 'none',
            confidence: 0.95,
        };
    }

    private detectNetworkIntent(thought: string, args: any): TaskIntent {
        const url = args.url || '';
        const requiresAuth = this.detectApiAuth(thought, url);

        return {
            type: 'network_request',
            requiresAuthentication: requiresAuth,
            requiresUserInput: false,
            requiresExternalApp: false,
            estimatedWaitType: 'short',
            confidence: 0.9,
        };
    }

    // ============================================================================
    // Helper Detection Methods
    // ============================================================================

    /**
     * Detect if authentication is likely needed
     */
    private detectAuthNeed(thought: string, url: string): boolean {
        // Check for auth-related keywords in thought
        const authKeywords = [
            'login', 'sign in', 'authenticate', 'auth',
            '登录', '登陆', '认证', '授权'
        ];
        if (authKeywords.some(kw => thought.includes(kw))) {
            return true;
        }

        // Check for known auth-required sites
        const authSites = [
            'xiaohongshu.com',
            'twitter.com', 'x.com',
            'facebook.com',
            'linkedin.com',
            'instagram.com',
            'github.com',
            'gitlab.com',
            'reddit.com',
            'medium.com',
            // Can be extended
        ];

        return authSites.some(site => url.includes(site));
    }

    /**
     * Detect if API requires authentication
     */
    private detectApiAuth(thought: string, url: string): boolean {
        // API auth keywords
        const apiAuthKeywords = ['api key', 'token', 'authorization', 'bearer'];
        if (apiAuthKeywords.some(kw => thought.includes(kw))) {
            return true;
        }

        // Known auth-required API domains
        const authApis = [
            'api.github.com',
            'api.twitter.com',
            'graph.facebook.com',
            // Can be extended
        ];

        return authApis.some(api => url.includes(api));
    }

    /**
     * Detect interactive commands (require user input)
     */
    private detectInteractiveCommand(command: string): boolean {
        const interactiveCommands = [
            'ssh',
            'mysql',
            'psql',
            'mongo',
            'redis-cli',
            'ftp',
            'sftp',
            'telnet',
            // Interactive shells
            'python -i',
            'node --interactive',
            'irb', // Ruby
            // Can be extended
        ];

        return interactiveCommands.some(cmd =>
            command.startsWith(cmd + ' ') || command === cmd
        );
    }

    /**
     * Detect sudo commands (require password)
     */
    private detectSudoCommand(command: string): boolean {
        return command.trim().startsWith('sudo ');
    }

    /**
     * Detect commands that launch external applications
     */
    private detectExternalApp(command: string): boolean {
        const externalApps = [
            // Editors
            'code', 'vim', 'vi', 'nano', 'emacs', 'notepad', 'notepad++',
            'subl', 'atom', 'gedit',

            // Browsers
            'chrome', 'firefox', 'safari', 'edge', 'brave',

            // IDEs
            'idea', 'pycharm', 'webstorm', 'vscode',

            // Image viewers
            'gimp', 'photoshop', 'preview', 'eog',

            // Video players
            'vlc', 'mpv', 'mplayer',

            // Can be extended
        ];

        const commandLower = command.toLowerCase();
        return externalApps.some(app => {
            // Check if command starts with app name
            const regex = new RegExp(`\\b${app}\\b`);
            return regex.test(commandLower);
        });
    }
}

/**
 * Factory function
 */
export function createIntentDetector(): IntentDetector {
    return new IntentDetector();
}
