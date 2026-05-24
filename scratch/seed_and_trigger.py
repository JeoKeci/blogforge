import sqlite3
import json
import os
import sys
from datetime import datetime

# Adjust path so we can import celery app from worker
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "worker"))
from main import app as celery_app

db_path = os.path.join(os.path.dirname(__file__), "..", "prisma", "dev.db")

def seed_db():
    print(f"Connecting to SQLite database at {db_path}...")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Enable foreign keys just to be safe/compliant
    cursor.execute("PRAGMA foreign_keys = ON;")
    
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    
    user_id = "test-user-id"
    project_id = "test-project-id"
    content_plan_id = "test-content-plan-id"
    article_plan_id = "test-article-plan-id"
    article_id = "test-article-id"
    
    # 1. Seed User
    cursor.execute("SELECT id FROM User WHERE id = ?", (user_id,))
    if not cursor.fetchone():
        print("Seeding User...")
        cursor.execute(
            "INSERT INTO User (id, email, name, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, "test@example.com", "Test User", None, now_str, now_str)
        )
        
    # 2. Seed Project
    cursor.execute("SELECT id FROM Project WHERE id = ?", (project_id,))
    if not cursor.fetchone():
        print("Seeding Project...")
        cursor.execute(
            "INSERT INTO Project (id, userId, name, siteUrl, state, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (project_id, user_id, "Test Project", "https://example.com", "CREATED", now_str, now_str)
        )
        
    # 3. Seed ContentPlan
    cursor.execute("SELECT id FROM ContentPlan WHERE id = ?", (content_plan_id,))
    if not cursor.fetchone():
        print("Seeding ContentPlan...")
        cursor.execute(
            "INSERT INTO ContentPlan (id, projectId, createdAt) VALUES (?, ?, ?)",
            (content_plan_id, project_id, now_str)
        )
        
    # 4. Seed ArticlePlan
    cursor.execute("SELECT id FROM ArticlePlan WHERE id = ?", (article_plan_id,))
    if not cursor.fetchone():
        print("Seeding ArticlePlan...")
        outline_json = json.dumps([
            {"title": "1. Giriş", "level": 2},
            {"title": "2. SEO Uyumlu Makale Nasıl Yazılır?", "level": 2},
            {"title": "3. Sonuç", "level": 2}
        ])
        cursor.execute(
            """INSERT INTO ArticlePlan 
               (id, contentPlanId, [order], title, primaryKeyword, secondaryKeywords, searchIntent, contentType, targetWordCount, priority, geoTarget, outline, status, createdAt) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                article_plan_id, content_plan_id, 1, "SEO Uyumlu Makale Yazım Kılavuzu", 
                "seo uyumlu makale", "[]", "informational", "guide", 1000, "high", "TR", 
                outline_json, "planned", now_str
            )
        )
        
    # 5. Seed Article
    cursor.execute("SELECT id FROM Article WHERE id = ?", (article_id,))
    if not cursor.fetchone():
        print("Seeding Article...")
        cursor.execute(
            """INSERT INTO Article 
               (id, projectId, articlePlanId, title, slug, metaDescription, htmlContent, markdownContent, excerpt, focusKeyword, seoScore, readabilityScore, wordCount, featuredImage, inlineImages, state, currentVersion, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                article_id, project_id, article_plan_id, "SEO Uyumlu Makale Yazım Kılavuzu",
                "seo-uyumlu-makale-yazim-kilavuzu", "SEO uyumlu makale yazımı hakkında detaylı kılavuz.",
                "", "", None, "seo uyumlu makale", None, None, 0, None, None, "WRITING", 1, now_str, now_str
            )
        )
    
    conn.commit()
    conn.close()
    print("Database seeding completed successfully.")

def trigger_celery_task():
    print("Triggering Celery task for Section 1...")
    
    # tasks.generate_section_iterative parameters:
    # (article_id, project_id, section_order, heading_title, previous_content="", static_rules="")
    result = celery_app.send_task(
        "tasks.generate_section_iterative",
        args=[
            "test-article-id",
            "test-project-id",
            1,
            "1. Giriş",
            "", # previous_content
            "Dil Türkçe olmalı. Zengin HTML (p, strong, ul, li) kullanılmalı. Makale giriş bölümü olduğu için konuya hızlı ve çarpıcı bir giriş yapmalı."
        ]
    )
    print(f"Task sent successfully! Task ID: {result.id}")

if __name__ == "__main__":
    seed_db()
    trigger_celery_task()
