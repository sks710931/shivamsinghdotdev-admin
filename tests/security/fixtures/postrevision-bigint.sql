-- Throwaway local database fixture for exercising migration 0003 repair path
-- (variant A, empty -> drop+recreate) and error 51003 (variant B, rows present).
-- Never run against a non-local DB.

IF OBJECT_ID(N'dbo.PostRevision') IS NOT NULL DROP TABLE dbo.PostRevision;

CREATE TABLE dbo.PostRevision (
    Id INT IDENTITY PRIMARY KEY,
    PostId INT NOT NULL,
    BodyHtml NVARCHAR(MAX) NULL,
    RowVersion BIGINT NOT NULL DEFAULT 0
);

-- variant B: with rows
-- INSERT INTO dbo.PostRevision (PostId) VALUES (1);
