-- Posts slice 1. Guards keep each change safe to re-run on a database that already has it.
-- The status index is compiled with EXEC so PublishedAt exists after the ALTER in this batch.

IF COL_LENGTH(N'dbo.BlogPost', N'RowVersion') IS NULL
  ALTER TABLE dbo.BlogPost ADD RowVersion rowversion;

IF COL_LENGTH(N'dbo.BlogPost', N'PublishedAt') IS NULL
  ALTER TABLE dbo.BlogPost ADD PublishedAt datetimeoffset NULL;

IF OBJECT_ID(N'dbo.CK_BlogPost_Status', N'C') IS NULL
  ALTER TABLE dbo.BlogPost ADD CONSTRAINT CK_BlogPost_Status
    CHECK (Status IN ('draft', 'published', 'archived'));

IF OBJECT_ID(N'dbo.CK_AdminUser_Role', N'C') IS NULL
  ALTER TABLE dbo.AdminUser ADD CONSTRAINT CK_AdminUser_Role
    CHECK (Role IN ('admin', 'guest'));

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_BlogPost_Status_PublishedAt'
    AND object_id = OBJECT_ID(N'dbo.BlogPost')
)
  EXEC(N'CREATE INDEX IX_BlogPost_Status_PublishedAt ON dbo.BlogPost (Status, PublishedAt DESC);');

IF OBJECT_ID(N'dbo.PostRevision', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.PostRevision (
    Id uniqueidentifier NOT NULL CONSTRAINT PK_PostRevision PRIMARY KEY,
    PostId uniqueidentifier NOT NULL,
    AuthorId uniqueidentifier NOT NULL,
    Title nvarchar(200) NOT NULL,
    Slug varchar(180) NOT NULL,
    Summary nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_Summary DEFAULT N'',
    Tags nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_Tags DEFAULT N'',
    SeoTitle nvarchar(200) NOT NULL CONSTRAINT DF_PostRevision_SeoTitle DEFAULT N'',
    SeoKeywords nvarchar(500) NOT NULL CONSTRAINT DF_PostRevision_SeoKeywords DEFAULT N'',
    BodyHtml nvarchar(max) NOT NULL,
    State varchar(20) NOT NULL,
    BaseVersion binary(8) NOT NULL,
    RowVersion rowversion,
    CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_PostRevision_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetimeoffset NOT NULL CONSTRAINT DF_PostRevision_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_PostRevision_Post FOREIGN KEY (PostId) REFERENCES dbo.BlogPost (Id),
    CONSTRAINT FK_PostRevision_Author FOREIGN KEY (AuthorId) REFERENCES dbo.AdminUser (Id),
    CONSTRAINT CK_PostRevision_State CHECK (State IN ('pending', 'published', 'discarded'))
  );

  CREATE UNIQUE INDEX IX_PostRevision_PendingPost
    ON dbo.PostRevision (PostId)
    WHERE State = 'pending';
END
