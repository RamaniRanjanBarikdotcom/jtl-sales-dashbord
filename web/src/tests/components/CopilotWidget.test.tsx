import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopilotWidget } from '@/components/copilot/CopilotWidget';

const flags = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
const route = vi.hoisted(() => ({ value: '/dashboard/overview' }));
const access = vi.hoisted(() => ({ value: true }));

vi.mock('next/navigation', () => ({ usePathname: () => route.value }));
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ data: flags.value }) }));
vi.mock('@/hooks/useCopilotChat', () => ({
    useCopilotChat: () => ({
        messages: [], busy: false, error: '', ask: vi.fn(), reset: vi.fn(),
        conversationId: null, status: { enabled: true, configured: true, ready: true, reason: null },
    }),
}));
vi.mock('@/lib/store', () => ({
    useStore: (selector: (state: unknown) => unknown) => selector({ can: () => access.value }),
}));

const ON = { AI_ANALYTICS_ENABLED: true, AI_ANALYTICS_SALES_ENABLED: true };

describe('CopilotWidget', () => {
    beforeEach(() => {
        flags.value = { ...ON };
        route.value = '/dashboard/overview';
        access.value = true;
    });

    it('offers the launcher on dashboard pages when the feature is live', () => {
        render(<CopilotWidget />);
        const launcher = screen.getByLabelText('Open Analytics Copilot');
        expect(launcher.textContent).toContain('Ask AI');
    });

    it('stays hidden while the backend feature flag is off', () => {
        flags.value = { AI_ANALYTICS_ENABLED: false, AI_ANALYTICS_SALES_ENABLED: true };
        const { container } = render(<CopilotWidget />);
        expect(container.firstChild).toBeNull();
    });

    it('stays hidden until the flags have loaded', () => {
        flags.value = {};
        const { container } = render(<CopilotWidget />);
        expect(container.firstChild).toBeNull();
    });

    it('stays hidden from users without Copilot access', () => {
        access.value = false;
        const { container } = render(<CopilotWidget />);
        expect(container.firstChild).toBeNull();
    });

    it('does not duplicate itself on the full Copilot page', () => {
        route.value = '/dashboard/copilot';
        const { container } = render(<CopilotWidget />);
        expect(container.firstChild).toBeNull();
    });

    it('opens the popup on click and closes it again', () => {
        render(<CopilotWidget />);
        fireEvent.click(screen.getByLabelText('Open Analytics Copilot'));
        expect(screen.getByRole('dialog', { name: 'Analytics Copilot' })).toBeTruthy();
        fireEvent.click(screen.getByLabelText('Close Copilot'));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes the popup on Escape', () => {
        render(<CopilotWidget />);
        fireEvent.click(screen.getByLabelText('Open Analytics Copilot'));
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('offers both the suggestion dropdown and a text input inside the popup', () => {
        render(<CopilotWidget />);
        fireEvent.click(screen.getByLabelText('Open Analytics Copilot'));
        expect(screen.getByLabelText('Ask a sales question')).toBeTruthy();
        fireEvent.click(screen.getByLabelText('Suggested questions'));
        expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
});
