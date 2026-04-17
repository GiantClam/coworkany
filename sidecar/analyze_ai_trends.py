import pandas as pd


def main():
    df = pd.read_csv('ai_trends_data.csv')

    print('=== AI Trends Dataset Preview ===')
    print(df.head(), end='\n\n')

    print('=== Key Metrics (2024) ===')
    key_2024 = df[df['year'] == 2024][['metric', 'value', 'unit']]
    print(key_2024.to_string(index=False), end='\n\n')

    # Adoption lift calculations
    def get_value(metric, year):
        row = df[(df['metric'] == metric) & (df['year'] == year)]
        return float(row['value'].iloc[0])

    org_ai_2023 = get_value('Org AI adoption rate', 2023)
    org_ai_2024 = get_value('Org AI adoption rate', 2024)
    genai_2023 = get_value('GenAI in >=1 business function', 2023)
    genai_2024 = get_value('GenAI in >=1 business function', 2024)

    print('=== Adoption Growth Analysis ===')
    print(f'Org AI adoption: {org_ai_2023:.1f}% -> {org_ai_2024:.1f}% | +{org_ai_2024-org_ai_2023:.1f} pct points')
    print(f'GenAI business-function adoption: {genai_2023:.1f}% -> {genai_2024:.1f}% | +{genai_2024-genai_2023:.1f} pct points', end='\n\n')

    # Investment concentration analysis
    us = get_value('US private AI investment', 2024)
    cn = get_value('China private AI investment', 2024)
    uk = get_value('UK private AI investment', 2024)

    print('=== Investment Concentration (2024) ===')
    print(f'US/China ratio: {us/cn:.2f}x')
    print(f'US/UK ratio: {us/uk:.2f}x')


if __name__ == '__main__':
    main()
