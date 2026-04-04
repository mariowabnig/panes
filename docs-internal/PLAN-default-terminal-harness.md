# Default Terminal Harness (Global Auto-Launch)

## Goal
Add an app-level setting to pick which CLI auto-launches whenever a new terminal opens — unless overridden by a thread-specific or startup preset harness.

## Tasks
- [ ] Add `defaultHarnessId` to `harnessStore.ts` with localStorage persistence
- [ ] Add "Select as default" button to each installed harness in `HarnessPanel.tsx`
- [ ] Use `defaultHarnessId` in `TerminalPanel.tsx` bootstrap fallback (between thread-harness and bare session)
- [ ] Test build compiles

## Files
- `src/stores/harnessStore.ts`
- `src/components/onboarding/HarnessPanel.tsx`
- `src/components/terminal/TerminalPanel.tsx`
