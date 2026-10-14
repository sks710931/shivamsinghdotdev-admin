-- 0003: repair PostRevision created by the old runtime DDL (RowVersion bigint instead of rowversion).
-- Empty table: drop and recreate with the 0002 definition. Non-empty: fail loudly, never silently keep the wrong type.
IF OBJECT_ID(N'dbo.PostRevision', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
     WHERE c.object_id = OBJECT_ID(N'dbo.PostRevision') AND c.name = N'RowVersion' AND t.name = N'timestamp')
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.PostRevision)
    THROW 51003, N'PostRevision has rows but RowVersion is not rowversion (legacy runtime schema). Back up and migrate the rows manually, then rerun db:migrate.', 1;

  DROP TABLE dbo.PostRevision;

  EXEC (N'  CREATE TABLE dbo.PostRevision (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_PostRevision PRIMARY KEY,
    PostId uniqueidentifier NOT NULL,
    AuthorId uniqueidentifier NOT NULL,
    Title nvarchar(200) NOT NULL,
    Slug varchar(180) NOT NULL,
    Summary nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_Summary DEFAULT N'''',
    Tags nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_Tags DEFAULT N'''',
    SeoTitle nvarchar(200) NOT NULL CONSTRAINT DF_PostRevision_SeoTitle DEFAULT N'''',
    SeoKeywords nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_SeoKeywords DEFAULT N'''',
    BodyHtml nvarchar(max) NOT NULL,
    State varchar(20) NOT NULL,
    BaseVersion binary(8) NOT NULL,
    RowVersion rowversion,
    CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_PostRevision_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetimeoffset NOT NULL CONSTRAINT DF_PostRevision_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PostRevision_Post FOREIGN KEY (PostId) REFERENCES dbo.BlogPost (Id),
    CONSTRAINT FK_PostRevision_Author FOREIGN KEY (AuthorId) REFERENCES dbo.AdminUser (Id),
    CONSTRAINT CK_PostRevision_State CHECK (State IN (''pending'', ''published'', ''discarded''))
  );

  CREATE UNIQUE INDEX IX_PostRevision_PendingPost
    ON dbo.PostRevision (PostId)');
END
