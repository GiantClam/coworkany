export function toOpenAIUserContent(
    blocks: Array<Record<string, any>>
): Array<Record<string, any>> {
    return blocks
        .filter((block) => block.type === 'text' || block.type === 'image')
        .map((block) => {
            if (block.type === 'text') {
                return {
                    type: 'text',
                    text: block.text,
                };
            }

            if (block.source?.type === 'url') {
                return {
                    type: 'image_url',
                    image_url: {
                        url: block.source.url,
                    },
                };
            }

            return {
                type: 'image_url',
                image_url: {
                    url: `data:${block.source?.mediaType || 'image/png'};base64,${block.source?.data || ''}`,
                },
            };
        });
}
