const transparent = 'rgba(0,0,0,0)';
const inputBackground = 'rgba(255,255,255,0.045)';
const line = 'rgba(255,255,255,0.11)';

export const clerkAuthAppearance = {
  variables: {
    colorPrimary: '#f7f7f5',
    colorPrimaryForeground: '#090909',
    colorForeground: '#f7f7f5',
    colorMutedForeground: 'rgba(255,255,255,0.56)',
    colorBackground: transparent,
    colorInput: inputBackground,
    colorInputForeground: '#ffffff',
    colorMuted: 'rgba(255,255,255,0.055)',
    colorNeutral: '#ffffff',
    colorBorder: line,
    colorRing: 'rgba(255,255,255,0.24)',
    colorShadow: '#000000',
    borderRadius: '8px',
    spacing: '0.85rem',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  elements: {
    rootBox: {
      width: '100%',
      maxWidth: '100%',
    },
    cardBox: {
      width: '100%',
      maxWidth: '100%',
      boxShadow: 'none',
    },
    card: {
      width: '100%',
      maxWidth: '100%',
      padding: 0,
      border: 0,
      background: transparent,
      boxShadow: 'none',
    },
    header: {
      display: 'none',
    },
    socialButtonsBlockButton: {
      minHeight: '44px',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.07)',
      boxShadow: 'none',
      color: '#ffffff',
      '&:hover, &:focus': {
        background: 'rgba(255,255,255,0.10)',
      },
    },
    socialButtonsBlockButtonText: {
      color: '#ffffff',
      fontWeight: 650,
    },
    dividerLine: {
      background: line,
    },
    dividerText: {
      color: 'rgba(255,255,255,0.40)',
      fontSize: '12px',
    },
    otpCodeField: {
      width: '100%',
    },
    otpCodeFieldInputContainer: {
      width: '100%',
      overflow: 'visible',
    },
    otpCodeFieldInputs: {
      display: 'flex',
      width: '100%',
      flexWrap: 'nowrap',
      justifyContent: 'center',
      gap: '6px',
    },
    otpCodeFieldInput: {
      width: '42px',
      minWidth: '42px',
      height: '46px',
      flex: '0 0 42px',
      padding: 0,
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '8px',
      background: inputBackground,
      boxShadow: 'none',
      color: '#ffffff',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '18px',
      fontWeight: 700,
      textAlign: 'center',
      '&:focus, &[data-focus="true"], &[data-focus-within="true"]': {
        borderColor: 'rgba(255,255,255,0.42)',
        boxShadow: '0 0 0 3px rgba(255,255,255,0.06)',
      },
    },
    formFieldLabel: {
      color: 'rgba(255,255,255,0.76)',
      fontSize: '13px',
      fontWeight: 650,
    },
    formFieldInput: {
      minHeight: '44px',
      border: `1px solid ${line}`,
      borderRadius: '8px',
      background: inputBackground,
      boxShadow: 'none',
      color: '#ffffff',
      '&:focus': {
        borderColor: 'rgba(255,255,255,0.32)',
        boxShadow: '0 0 0 3px rgba(255,255,255,0.055)',
      },
    },
    formButtonPrimary: {
      minHeight: '44px',
      border: '1px solid #ffffff',
      borderRadius: '8px',
      background: '#ffffff',
      boxShadow: '0 14px 38px rgba(255,255,255,0.10)',
      color: '#090909',
      fontSize: '14px',
      fontWeight: 750,
      textTransform: 'none',
      '&:hover, &:focus, &:active': {
        background: '#f2f3f4',
      },
    },
    formFieldAction: {
      color: 'rgba(255,255,255,0.65)',
    },
    formResendCodeLink: {
      color: 'rgba(255,255,255,0.75)',
    },
    identityPreview: {
      border: `1px solid ${line}`,
      background: inputBackground,
    },
    identityPreviewText: {
      color: '#ffffff',
    },
    identityPreviewEditButton: {
      color: 'rgba(255,255,255,0.65)',
    },
    footer: {
      display: 'none',
    },
  },
};
