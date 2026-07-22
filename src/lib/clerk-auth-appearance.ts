export const clerkAuthAppearance = {
  variables: {
    colorPrimary: '#ffffff',
    colorBackground: 'transparent',
    colorInputBackground: 'rgba(255,255,255,0.045)',
    colorInputText: '#ffffff',
    colorText: '#f7f7f5',
    colorTextSecondary: 'rgba(255,255,255,0.62)',
    colorNeutral: '#ffffff',
    borderRadius: '8px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  elements: {
    rootBox: 'w-full max-w-full',
    cardBox: 'w-full max-w-full shadow-none',
    card: 'w-full max-w-full gap-3 bg-transparent p-0 shadow-none',
    header: 'hidden',
    socialButtonsBlockButton:
      'min-h-11 rounded-lg border border-white/20 bg-white/[0.07] text-white shadow-none hover:bg-white/10',
    socialButtonsBlockButtonText: 'font-semibold text-white',
    dividerLine: 'bg-white/10',
    dividerText: 'text-xs text-white/40',
    formFieldLabel: 'text-[13px] font-semibold text-white/75',
    formFieldInput:
      'min-h-11 rounded-lg border border-white/10 bg-white/[0.045] text-white shadow-none placeholder:text-white/30 focus:border-white/30 focus:ring-2 focus:ring-white/5',
    formButtonPrimary:
      'min-h-11 rounded-lg border border-white bg-white text-sm font-bold text-black shadow-[0_14px_38px_rgba(255,255,255,0.10)] hover:bg-[#f2f3f4]',
    footer: 'hidden',
    formFieldAction: 'text-white/65 hover:text-white',
    formResendCodeLink: 'text-white/75 hover:text-white',
    identityPreview: 'border border-white/10 bg-white/[0.045]',
    identityPreviewText: 'text-white',
    identityPreviewEditButton: 'text-white/65',
  },
};
