FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run sets $PORT; main.py reads it (defaults to 8080 locally)
ENV PORT=8080
EXPOSE 8080

CMD ["python3", "main.py"]
