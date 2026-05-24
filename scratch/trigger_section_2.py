import sqlite3
import os
import sys

# Adjust path so we can import celery app from worker
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "worker"))
from main import app as celery_app

db_path = os.path.join(os.path.dirname(__file__), "..", "prisma", "dev.db")

def trigger_section_2():
    print(f"Connecting to SQLite database at {db_path}...")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Query Section 1 content to pass as rolling context (previous_content)
    cursor.execute(
        "SELECT htmlContent FROM ArticleSection WHERE articleId = ? AND [order] = ?",
        ("test-article-id", 1)
    )
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        print("Error: Section 1 not found in database. Make sure Section 1 generated successfully.")
        return
        
    previous_content = row[0]
    print(f"Retrieved Section 1 content ({len(previous_content)} characters).")
    
    print("Triggering Celery task for Section 2...")
    result = celery_app.send_task(
        "tasks.generate_section_iterative",
        args=[
            "test-article-id",
            "test-project-id",
            2,
            "2. SEO Uyumlu Makale Nasıl Yazılır?",
            previous_content,
            "Dil Türkçe olmalı. Zengin HTML (p, strong, ul, li) kullanılmalı. Makale ana bölümü olduğu için pratik SEO tekniklerini anlatmalı."
        ]
    )
    print(f"Task sent successfully! Task ID: {result.id}")

if __name__ == "__main__":
    trigger_section_2()
