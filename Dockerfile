FROM node:20-slim

WORKDIR /app

# Create cache directory
RUN mkdir -p /data/cache

# Install required dependencies using apt-get (since we're using node:slim which is Debian-based)
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create public directory
RUN mkdir -p /app/public

# Expose the default port
EXPOSE 3000

# Create build timestamp at the end to avoid caching
RUN date -u +'%Y-%m-%d %H:%M:%S UTC' > /app/public/build.txt && \
    echo "Build timestamp: $(cat /app/public/build.txt)"

# Set cache path environment variable
ENV CACHE_PATH=/data/cache

# set to not use cache
ENV USE_CACHE=false

# Create a volume for persistent cache
VOLUME /data/cache

# Debug mode is disabled by default
ENV DEBUG_MODE=false

# To enable debug mode, uncomment the next line:
# ENV DEBUG_MODE=true

# Start the application
CMD ["npm", "start"] 