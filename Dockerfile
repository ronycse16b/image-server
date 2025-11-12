# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the project
COPY . .

# Create uploads folder
RUN mkdir -p uploads

# Expose port
EXPOSE 4000

# Start server
CMD ["node", "server.js"]
