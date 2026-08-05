const transparent = 'rgba(0,0,0,0)';
const inputBackground = 'rgba(255,250,240,0.045)';
const line = 'rgba(255,250,240,0.11)';
const warm = '#f2c36b';
const warmSoft = '#f8dfaa';
const warmText = '#fffaf0';
const onWarm = '#100e0c';

export const clerkAuthAppearance = {
  variables: {
    colorPrimary: warm,
    colorPrimaryForeground: onWarm,
    colorForeground: warmText,
    colorMutedForeground: 'rgba(255,250,240,0.58)',
    colorBackground: transparent,
    colorInput: inputBackground,
    colorInputForeground: warmText,
    colorMuted: 'rgba(255,250,240,0.055)',
    colorNeutral: warmText,
    colorBorder: line,
    colorRing: 'rgba(242,195,107,0.28)',
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
      border: '1px solid rgba(255,250,240,0.18)',
      borderRadius: '8px',
      background: 'rgba(255,250,240,0.07)',
      boxShadow: 'none',
      color: warmText,
      '&:hover, &:focus': {
        borderColor: 'rgba(242,195,107,0.34)',
        background: 'rgba(242,195,107,0.10)',
      },
    },
    socialButtonsBlockButtonText: {
      color: warmText,
      fontWeight: 650,
    },
    dividerLine: {
      background: line,
    },
    dividerText: {
      color: 'rgba(255,250,240,0.42)',
      fontSize: '12px',
    },
    otpCodeField: {
      width: '100%',
    },
    otpCodeFieldInputContainer: {
      width: '100%',
      overflow: 'visible',
      boxSizing: 'border-box',
      paddingTop: '8px',
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
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'rgba(255,250,240,0.28)',
      borderRadius: '8px',
      backgroundColor: 'rgba(255,250,240,0.075)',
      boxShadow: 'none',
      color: warmText,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '18px',
      fontWeight: 700,
      textAlign: 'center',
      '&:focus, &[data-focus="true"], &[data-focus-within="true"]': {
        borderColor: 'rgba(242,195,107,0.46)',
        boxShadow: '0 0 0 3px rgba(242,195,107,0.08)',
      },
    },
    formFieldLabel: {
      color: 'rgba(255,250,240,0.76)',
      fontSize: '13px',
      fontWeight: 650,
    },
    formFieldInput: {
      minHeight: '44px',
      border: `1px solid ${line}`,
      borderRadius: '8px',
      background: inputBackground,
      boxShadow: 'none',
      color: warmText,
      '&:focus': {
        borderColor: 'rgba(242,195,107,0.42)',
        boxShadow: '0 0 0 3px rgba(242,195,107,0.08)',
      },
    },
    formButtonPrimary: {
      minHeight: '44px',
      border: '1px solid rgba(242,195,107,0.72)',
      borderRadius: '8px',
      background: `linear-gradient(180deg, ${warmSoft}, ${warm})`,
      boxShadow: '0 14px 38px rgba(242,195,107,0.14)',
      color: onWarm,
      fontSize: '14px',
      fontWeight: 750,
      textTransform: 'none',
      '&:hover, &:focus, &:active': {
        background: `linear-gradient(180deg, #ffe8b7, ${warm})`,
      },
    },
    formFieldAction: {
      color: 'rgba(255,250,240,0.65)',
    },
    formResendCodeLink: {
      color: 'rgba(255,250,240,0.75)',
    },
    identityPreview: {
      border: `1px solid ${line}`,
      background: inputBackground,
    },
    identityPreviewText: {
      color: warmText,
    },
    identityPreviewEditButton: {
      color: 'rgba(255,250,240,0.65)',
    },
    footer: {
      display: 'none',
    },
  },
};
