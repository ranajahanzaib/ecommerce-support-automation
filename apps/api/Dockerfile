FROM python:3.12-slim
WORKDIR /app
COPY apps/api/pyproject.toml ./pyproject.toml
COPY apps/api/commerceaction ./commerceaction
COPY policies ./policies
COPY scripts ./scripts
COPY evaluations ./evaluations
RUN pip install --no-cache-dir .
EXPOSE 8000
CMD ["uvicorn", "commerceaction.main:app", "--host", "0.0.0.0", "--port", "8000"]
