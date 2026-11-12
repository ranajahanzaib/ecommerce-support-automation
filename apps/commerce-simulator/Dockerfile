FROM python:3.12-slim
WORKDIR /app
COPY apps/commerce-simulator/pyproject.toml ./pyproject.toml
COPY apps/commerce-simulator/commerce_simulator ./commerce_simulator
RUN pip install --no-cache-dir .
EXPOSE 8001
CMD ["uvicorn", "commerce_simulator.main:app", "--host", "0.0.0.0", "--port", "8001"]
