-- The institution's own administrator is now called "admin" (it was "dean"). Existing rows keep their account.
ALTER TYPE "role" RENAME VALUE 'dean' TO 'admin';
