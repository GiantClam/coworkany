
import { openInBrowserTool } from '../src/tools/builtin';

async function testBrowser() {
    console.log('Testing open_in_browser tool...');
    const url = 'https://www.google.com/search?q=test_coworkany_browser_launch';

    try {
        const result = await openInBrowserTool.handler({ url });
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error);
    }
}

testBrowser();
