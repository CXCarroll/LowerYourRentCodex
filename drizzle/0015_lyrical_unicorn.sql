CREATE INDEX "admin_uploads_created_at_idx" ON "admin_uploads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "building_permits_cbsa_period_idx" ON "building_permits" USING btree ("cbsa_code","year","month");--> statement-breakpoint
CREATE INDEX "cbsa_population_cbsa_year_idx" ON "cbsa_population" USING btree ("cbsa_code","year");--> statement-breakpoint
CREATE INDEX "vacancy_rates_cbsa_period_idx" ON "vacancy_rates" USING btree ("cbsa_code","year","quarter");