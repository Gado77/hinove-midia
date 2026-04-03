-- ============================================
-- FIX: SCREEN_COMMANDS RLS FOR ANDROID PLAYER
-- ============================================
-- Problem: The Android player uses the anon key (not an authenticated user),
-- so auth.uid() returns NULL and RLS blocks ALL reads.
-- This means the player NEVER sees pending commands.
--
-- Solution: Allow anon to SELECT and UPDATE commands.
-- The player needs to:
--   1. READ pending commands (to know what to execute)
--   2. UPDATE executed_at (to mark as done)

-- Drop the restrictive policies that require auth.uid()
DROP POLICY IF EXISTS "Players read pending commands" ON screen_commands;

-- Allow anyone (including anon key) to read commands
CREATE POLICY "Anyone can read commands"
ON screen_commands FOR SELECT
USING (true);

-- Allow anyone to update commands (needed for markCommandExecuted)
CREATE POLICY "Anyone can update commands"
ON screen_commands FOR UPDATE
USING (true)
WITH CHECK (true);
