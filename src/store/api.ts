import axios from "axios";
// @ts-ignore TODO add type
const apiUrl = import.meta.env.VITE_API_URL;

console.log("apiUrl", apiUrl);

const api = axios.create({
  baseURL: apiUrl,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // important for cookies
});

export default api;
