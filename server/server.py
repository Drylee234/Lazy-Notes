from flask import Flask, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime as dt
from markupsafe import escape


app = Flask(__name__)

app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///lazynotes.db"

db = SQLAlchemy(app)

CORS(app)


CATEGORIES = {
    "header",
    "definition",
    "formula",
    "list head",
    "list point",
    "summary"
}

VALID_YEARS     = {"1", "2", "3", "4", "5"}
VALID_SEMESTERS = {"1", "2"}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(
        db.String,
        nullable=False
    )

    details = db.Column(db.String)

    year = db.Column(
        db.Enum("1", "2", "3", "4", "5"),
        nullable=False
    )

    semester = db.Column(
        db.Enum("1", "2"),
        nullable=False
    )

    topics = db.relationship(
        "Topic",
        backref="course",
        order_by="Topic.id",
        cascade="all, delete-orphan"
    )


class Topic(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    courseId = db.Column(
        db.Integer,
        db.ForeignKey("course.id"),
        nullable=False
    )

    name = db.Column(
        db.String,
        nullable=False
    )

    details = db.Column(db.String)

    highlights = db.relationship(
        "Highlight",
        backref="topic",
        order_by="Highlight.id",
        cascade="all, delete-orphan"
    )


class Highlight(db.Model):
    id = db.Column(
        db.Integer,
        primary_key=True
    )

    topicId = db.Column(
        db.Integer,
        db.ForeignKey("topic.id"),
        nullable=False
    )

    text = db.Column(
        db.String,
        nullable=False
    )

    category = db.Column(
        db.Enum(
            "header",
            "definition",
            "formula",
            "list head",
            "list point",
            "summary"
        ),
        nullable=False
    )

    context = db.Column(db.String)
    annotation = db.Column(db.String)
    source = db.Column(db.String)

    lastModified = db.Column(
        db.DateTime,
        nullable=False
    )


EDITABLE_FIELDS = {
    "text",
    "category",
    "context",
    "annotation",
    "source"
}


# ---------------------------------------------------------------------------
# GET
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return {
        "status": "ok"
    }, 200


@app.route("/listCourses", methods=["GET"])
def list_courses():
    courses = Course.query.all()

    course_list = []

    for course in courses:
        # Derive last modified from the latest highlight across all topics.
        last_modified = None
        for topic in course.topics:
            if topic.highlights:
                candidate = topic.highlights[-1].lastModified
                if last_modified is None or candidate > last_modified:
                    last_modified = candidate

        course_list.append({
            "id": course.id,
            "name": course.name,
            "details": course.details,
            "year": course.year,
            "semester": course.semester,
            "topicCount": len(course.topics),
            "lastModified": (
                last_modified.isoformat()
                if last_modified
                else None
            )
        })

    return course_list, 200


@app.route("/listTopics", methods=["GET"])
def list_topics():
    course_id = request.args.get("courseId", type=int)

    if course_id is None:
        print("[/listTopics] 400 — Missing courseId param.")
        return {
            "status": "FAILED",
            "message": "Missing courseId"
        }, 400

    course = Course.query.get(course_id)

    if not course:
        print(f"[/listTopics] 404 — Course id '{course_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Course"
        }, 404

    topic_list = []

    for topic in course.topics:
        last_modified = (
            topic.highlights[-1].lastModified
            if topic.highlights
            else None
        )

        topic_list.append({
            "id": topic.id,
            "name": topic.name,
            "details": topic.details,
            "highlightCount": len(topic.highlights),
            "lastModified": (
                last_modified.isoformat()
                if last_modified
                else None
            )
        })

    return topic_list, 200


@app.route("/displayNotes", methods=["GET"])
def display_notes():
    topic_id = request.args.get("topicId", type=int)

    if topic_id is None:
        print("[/displayNotes] 400 — Missing topicId param.")
        return {
            "status": "FAILED",
            "message": "Missing topicId"
        }, 400

    topic = Topic.query.get(topic_id)

    if not topic:
        print(f"[/displayNotes] 404 — Topic id '{topic_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Topic"
        }, 404

    return parse_html(topic.highlights), 200


@app.route("/export", methods=["GET"])
def export():
    topic_id = request.args.get("topicId", type=int)

    if topic_id is None:
        print("[/export] 400 — Missing topicId param.")
        return {
            "status": "FAILED",
            "message": "Missing topicId"
        }, 400

    topic = Topic.query.get(topic_id)

    if not topic:
        print(f"[/export] 404 — Topic id '{topic_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Topic"
        }, 404

    md_content = parse_md(topic.highlights)

    filename = (
        f"{topic.course.name.replace(' ', '_')}"
        f"_{topic.name.replace(' ', '_')}_notes.md"
    )

    return {
        "status": "OK",
        "md": md_content,
        "filename": filename
    }, 200


# ---------------------------------------------------------------------------
# POST
# ---------------------------------------------------------------------------

@app.route("/newhighlight", methods=["POST"])
def new_highlight():
    data = request.get_json(silent=True) or {}

    required_fields = {
        "topicId",
        "text",
        "category"
    }

    if not required_fields.issubset(data):
        missing = required_fields - data.keys()
        print(f"[/newhighlight] 400 — Missing fields: {missing}. Received: {data}")
        return {
            "status": "FAILED",
            "message": "Missing required fields"
        }, 400

    if data["category"] not in CATEGORIES:
        print(f"[/newhighlight] 400 — Invalid category: '{data['category']}'. Valid: {CATEGORIES}")
        return {
            "status": "FAILED",
            "message": "Invalid category"
        }, 400

    topic = Topic.query.get(data["topicId"])

    if not topic:
        print(f"[/newhighlight] 404 — Topic id '{data['topicId']}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Topic"
        }, 404

    highlight = Highlight(
        topicId=topic.id,
        text=data["text"],
        category=data["category"],
        context=data.get("context"),
        annotation=data.get("annotation"),
        source=data.get("source"),
        lastModified=dt.now()
    )

    save_to_db(highlight)

    return {
        "status": "OK",
        "message": "Highlight saved"
    }, 200


@app.route("/createcourse", methods=["POST"])
def create_course():
    data = request.get_json(silent=True) or {}

    name     = data.get("name")
    year     = str(data.get("year", ""))
    semester = str(data.get("semester", ""))

    if not name or not year or not semester:
        print(f"[/createcourse] 400 — Missing fields. Received: {data}")
        return {
            "status": "FAILED",
            "message": "Missing required fields"
        }, 400

    if year not in VALID_YEARS:
        print(f"[/createcourse] 400 — Invalid year '{year}'. Valid: {VALID_YEARS}")
        return {
            "status": "FAILED",
            "message": "Invalid year — must be 1 to 5"
        }, 400

    if semester not in VALID_SEMESTERS:
        print(f"[/createcourse] 400 — Invalid semester '{semester}'. Valid: {VALID_SEMESTERS}")
        return {
            "status": "FAILED",
            "message": "Invalid semester — must be 1 or 2"
        }, 400

    if Course.query.filter_by(name=name).first():
        print(f"[/createcourse] 409 — Course '{name}' already exists.")
        return {
            "status": "FAILED",
            "message": "Course Exists"
        }, 409

    course = Course(
        name=name,
        year=year,
        semester=semester,
        details=data.get("details")
    )

    save_to_db(course)

    return {
        "status": "OK",
        "message": "Course Created",
        "id": course.id,
        "name": course.name
    }, 200


@app.route("/createtopic", methods=["POST"])
def create_topic():
    data = request.get_json(silent=True) or {}

    course_id = data.get("courseId")
    name      = data.get("name")

    if not course_id or not name:
        print(f"[/createtopic] 400 — Missing fields. Received: {data}")
        return {
            "status": "FAILED",
            "message": "Missing required fields"
        }, 400

    course = Course.query.get(course_id)

    if not course:
        print(f"[/createtopic] 404 — Course id '{course_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Course"
        }, 404

    topic = Topic(
        courseId=course_id,
        name=name,
        details=data.get("details")
    )

    save_to_db(topic)

    return {
        "status": "OK",
        "message": "Topic Created",
        "id": topic.id,
        "name": topic.name,
        "courseId": course_id
    }, 200


# ---------------------------------------------------------------------------
# PUT
# ---------------------------------------------------------------------------

@app.route("/updateHighlight", methods=["PUT"])
def update_highlight():
    update = request.get_json(silent=True) or {}

    topic_id = update.get("topicId")

    topic = Topic.query.get(topic_id)

    if not topic:
        print(f"[/updateHighlight] 404 — Topic id '{topic_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Topic"
        }, 404

    highlight_id = update.get("highlightId")

    highlight = Highlight.query.get(highlight_id)

    if not highlight:
        print(f"[/updateHighlight] 404 — Highlight id '{highlight_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Highlight id"
        }, 404

    if highlight.topicId != topic.id:
        print(f"[/updateHighlight] 403 — Highlight {highlight_id} belongs to topic {highlight.topicId}, not {topic_id}.")
        return {
            "status": "FAILED",
            "message": "Highlight does not belong to Topic"
        }, 403

    for key, value in update.items():
        if key not in EDITABLE_FIELDS:
            continue

        if key == "category" and value not in CATEGORIES:
            print(f"[/updateHighlight] 400 — Invalid category '{value}'.")
            return {
                "status": "FAILED",
                "message": "Invalid category"
            }, 400

        setattr(highlight, key, value)

    highlight.lastModified = dt.now()

    db.session.commit()

    return {
        "status": "OK",
        "message": "Highlight saved"
    }, 200


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

@app.route("/deleteHighlight", methods=["DELETE"])
def delete_highlight():
    highlight_id = request.args.get("highlightId", type=int)
    topic_id     = request.args.get("topicId", type=int)

    topic = Topic.query.get(topic_id)

    if not topic:
        print(f"[/deleteHighlight] 404 — Topic id '{topic_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Topic"
        }, 404

    highlight = Highlight.query.get(highlight_id)

    if not highlight:
        print(f"[/deleteHighlight] 404 — Highlight id '{highlight_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Highlight Id"
        }, 404

    if highlight.topicId != topic.id:
        print(f"[/deleteHighlight] 403 — Highlight {highlight_id} belongs to topic {highlight.topicId}, not {topic_id}.")
        return {
            "status": "FAILED",
            "message": "Highlight does not belong to Topic"
        }, 403

    delete_from_db(highlight)

    return {
        "status": "OK",
        "message": "Highlight Deleted"
    }, 200


@app.route("/deleteCourse", methods=["DELETE"])
def delete_course():
    course_id = request.args.get("courseId", type=int)

    course = Course.query.get(course_id)

    if not course:
        print(f"[/deleteCourse] 404 — Course id '{course_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Course"
        }, 404

    delete_from_db(course)

    return {
        "status": "OK",
        "message": "Course Deleted"
    }, 200


@app.route("/deleteTopic", methods=["DELETE"])
def delete_topic():
    topic_id = request.args.get("topicId", type=int)

    topic = Topic.query.get(topic_id)

    if not topic:
        print(f"[/deleteTopic] 404 — Topic id '{topic_id}' not found.")
        return {
            "status": "FAILED",
            "message": "Invalid Topic"
        }, 404

    delete_from_db(topic)

    return {
        "status": "OK",
        "message": "Topic Deleted"
    }, 200


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_html(highlights):
    parsed = []

    for highlight in highlights:
        text = str(escape(highlight.text))

        guide = {
            "header":     f"<h1>{text}</h1>",
            "definition": f"<p>{text}</p>",
            "formula":    f"<span>{text}</span>",
            "list head":  f"<h3>{text}</h3>",
            "list point": f"<li>{text}</li>",
            "summary":    f"<p>{text}</p>"
        }

        html = guide[highlight.category]

        parsed.append({
            "id":           highlight.id,
            "category":     highlight.category,
            "html":         html,
            "context":      highlight.context,
            "annotation":   highlight.annotation,
            "source":       highlight.source,
            "last modified": highlight.lastModified.isoformat()
        })

    return parsed


def parse_md(highlights):
    lines = []

    for highlight in highlights:
        text = highlight.text

        guide = {
            "header":     f"# {text}",
            "definition": f"**{text}**",
            "formula":    f"`{text}`",
            "list head":  f"### {text}",
            "list point": f"- {text}",
            "summary":    text
        }

        lines.append(guide[highlight.category])

        if highlight.annotation:
            lines.append(f"> {highlight.annotation}")

        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def save_to_db(obj):
    db.session.add(obj)
    db.session.commit()


def delete_from_db(obj):
    db.session.delete(obj)
    db.session.commit()


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        db.create_all()

    app.run(
        host="0.0.0.0",
        debug=True
    )
