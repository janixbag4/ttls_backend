# TTLS Backend API

This is the backend server for the TTLS (Technology for Teaching and Learning System) application.

## Prerequisites

- Node.js (v14 or higher)
- npm
- MongoDB Atlas account (already configured)

## Installation

1. Navigate to the backend folder:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

## Environment Configuration

The `.env` file is already configured with:
- MongoDB connection string
- JWT secret
- Port (5000)

You can use the provided `.env.example` as a template. Copy it to `.env` and replace values with your real credentials:

```text
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/<dbName>?retryWrites=true&w=majority&appName=Cluster0
MONGO_URI=... (optional alias)
PORT=8000
NODE_ENV=production
ADMIN_API_KEY=your_admin_api_key
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_cloud_api_key
CLOUDINARY_API_SECRET=your_cloud_api_secret
```

Important: keep `.env` out of version control and never commit real secrets.

## Running the Server

### Development Mode (with auto-reload):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

The server will run on `http://localhost:5000`

## API Endpoints

### Authentication Routes

#### Sign Up
- **POST** `/api/auth/signup`
- Body:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "idNumber": "2024-0001",
  "email": "john@example.com",
  "password": "password123",
  "role": "student",
  "department": "BSIT"
}
```

#### Login
- **POST** `/api/auth/login`
- Body:
```json
{
  "idNumber": "2024-0001",
  "password": "password123",
  "role": "student"
}
```

#### Get Current User
- **GET** `/api/auth/me`
- Header: `Authorization: Bearer <token>`

### Admin Routes

#### Get Pending Users
- **GET** `/api/admin/users/pending`
- Header: `Authorization: Bearer <token>`

#### Get All Users
- **GET** `/api/admin/users`
- Header: `Authorization: Bearer <token>`

#### Approve User
- **PUT** `/api/admin/users/:id/approve`
- Header: `Authorization: Bearer <token>`

#### Reject User
- **PUT** `/api/admin/users/:id/reject`
- Header: `Authorization: Bearer <token>`

#### Delete User
- **DELETE** `/api/admin/users/:id`
- Header: `Authorization: Bearer <token>`

## User Roles

The system supports 3 roles:
- **Student** - Can access student dashboard
- **Teacher** - Can access teacher dashboard
- **Admin** - Can manage users and approve registrations

## User Approval Flow

1. Users sign up and their status is set to "pending"
2. Admin must approve the user before they can login
3. Once approved, users can login with their credentials

## Database

- **Cluster**: cluster0
- **Database**: ttlsDB
- **Collections**: users

The User model includes:
- Personal information (firstName, lastName, email)
- Authentication (idNumber, password)
- Role and status
- Timestamps

## Testing

Test users can be created through the signup endpoint. All new users require admin approval before they can login.

## Troubleshooting

If you get a connection error:
1. Check that MongoDB Atlas cluster is running
2. Verify the connection string in `.env`
3. Ensure your IP is whitelisted in MongoDB Atlas
4. Check that the backend server is running on port 5000
