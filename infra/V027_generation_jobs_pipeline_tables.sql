-- Full generation job pipeline (Alembic h8i9j0k1l2m3 + i9j0k1l2m3n4 + j0k1l2m3n4o5 + k1l2m3n4o5p6).
-- Legacy DBs often only have generation_jobs(id) from infra/init.sql.

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(32) NOT NULL DEFAULT 'scene_based';
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS input_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS step_control JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS output_url TEXT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS logs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS ix_generation_jobs_execution_mode ON generation_jobs(execution_mode);

CREATE TABLE IF NOT EXISTS generation_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    step_name VARCHAR(64) NOT NULL,
    step_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_generation_steps_job_step UNIQUE (job_id, step_name)
);

CREATE INDEX IF NOT EXISTS ix_generation_steps_job_id ON generation_steps(job_id);
CREATE INDEX IF NOT EXISTS ix_generation_steps_status ON generation_steps(status);

CREATE TABLE IF NOT EXISTS generation_scenes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    scene_index INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    duration INTEGER NOT NULL,
    scene_role VARCHAR(32),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    start_image_url TEXT,
    end_image_url TEXT,
    video_url TEXT,
    error_message TEXT,
    scene_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_generation_scenes_job_id ON generation_scenes(job_id);
CREATE INDEX IF NOT EXISTS ix_generation_scenes_status ON generation_scenes(status);
