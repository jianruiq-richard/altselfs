-- Add editable custom prompt for investor integration assistant
ALTER TABLE "investor_integrations"
ADD COLUMN "assistantCustomPrompt" TEXT;
