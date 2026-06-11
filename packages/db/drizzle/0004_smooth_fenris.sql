CREATE INDEX "idx_canvas_characters_project" ON "canvas_characters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_locations_project" ON "canvas_locations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_canvas_projects_account_created" ON "canvas_projects" USING btree ("account_id","is_deleted","created_at");--> statement-breakpoint
CREATE INDEX "idx_canvas_shots_project_index" ON "canvas_shots" USING btree ("project_id","shot_index");--> statement-breakpoint
CREATE INDEX "idx_gen_records_account_created" ON "generation_records" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gen_records_status_category" ON "generation_records" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "idx_uploaded_files_account" ON "uploaded_files" USING btree ("account_id");