export interface CopilotSuggestion {
    label: string;
    question: string;
}

export interface CopilotSuggestionGroup {
    group: string;
    items: CopilotSuggestion[];
}

// Each suggestion maps onto a tool the backend actually exposes. Adding a prompt
// here that no tool can answer produces a confident "not available" reply.
export const COPILOT_SUGGESTIONS: CopilotSuggestionGroup[] = [
    {
        group: "Performance",
        items: [
            { label: "Today's sales", question: "What were our sales today?" },
            { label: "Yesterday's sales", question: "What were our sales yesterday?" },
            { label: "This month so far", question: "How are sales going this month so far?" },
            { label: "This year to date", question: "What is our revenue this year to date?" },
        ],
    },
    {
        group: "Comparisons",
        items: [
            { label: "This month vs last month", question: "Compare this month's sales to last month." },
            { label: "This week vs last week", question: "Compare this week's sales to last week." },
            { label: "Is revenue growing?", question: "Is our revenue growing compared to last month?" },
        ],
    },
    {
        group: "Trends",
        items: [
            { label: "Daily trend this month", question: "Show me the daily sales trend for this month." },
            { label: "Monthly trend this year", question: "Show me the monthly sales trend for this year." },
            { label: "Best day this month", question: "Which day this month had the highest revenue?" },
        ],
    },
    {
        group: "Channels",
        items: [
            { label: "Top channels", question: "Which sales channels performed best this month?" },
            { label: "Channel split", question: "How is this month's revenue split across channels?" },
            { label: "Amazon vs shop", question: "How did Amazon compare to the onlineshop this month?" },
        ],
    },
];

export const COPILOT_QUICK_PROMPTS: CopilotSuggestion[] = [
    { label: "Today's sales", question: "What were our sales today?" },
    { label: "vs last month", question: "Compare this month's sales to last month." },
    { label: "Top channels", question: "Which sales channels performed best this month?" },
];
