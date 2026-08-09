/**
 * Rate Limiter Middleware
 * Melindungi endpoint dari brute force dan abuse
 * Menggunakan in-memory store (sederhana, tanpa dependensi eksternal)
 */

import rateLimit from 'express-rate-limit'
import { sendError } from '../utils/response.js'

/**
 * Login rate limiter
 * - Max 10 attempts per akun (username) per 5 menit
 * - Mencegah brute force login tanpa mengunci semua user di IP yang sama
 * - 5 menit window agar cooldown tidak terlalu lama
 */
export const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 menit
    max: 10,
    message: {
        status: 'error',
        message: 'Too many login attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Limit per akun (username), bukan per IP, agar satu user yang salah password
    // tidak mengunci user lain di jaringan/NAT yang sama.
    keyGenerator: (req) => {
        const username = req.body?.username
        if (username) {
            return `login:${String(username).trim().toLowerCase()}`
        }
        // Fallback per IP untuk request tanpa username (malformed / bot)
        return `login:${req.ip || req.socket.remoteAddress}`
    },
    handler: (req, res) => {
        console.warn(`⚠️ [RATE LIMIT] Login exceeded for account: ${req.body?.username || req.ip}`)
        sendError(res, 'Too many login attempts. Please try again later.', 429)
    }
})

/**
 * General API rate limiter
 * - Max 100 requests per IP per menit
 * - Mencegah API abuse secara umum
 */
export const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 100,
    message: {
        status: 'error',
        message: 'Too many requests, please slow down.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ [RATE LIMIT] API exceeded for IP: ${req.ip}`)
        sendError(res, 'Too many requests, please slow down.', 429)
    }
})

/**
 * Sync/Pull rate limiter (lebih ketat)
 * - Max 10 requests per IP per menit
 * - Mencegah abuse pada operasi sync yang berat
 */
export const syncLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 10,
    message: {
        status: 'error',
        message: 'Too many sync requests. Please wait before trying again.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ [RATE LIMIT] Sync exceeded for IP: ${req.ip}`)
        sendError(res, 'Too many sync requests. Please wait before trying again.', 429)
    }
})

/**
 * Activity log limiter (ringan)
 * - Max 30 requests per IP per menit
 * - Untuk endpoint yang sering di-polling
 */
export const activityLogLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 30,
    message: {
        status: 'error',
        message: 'Too many requests, please slow down.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ [RATE LIMIT] Activity log exceeded for IP: ${req.ip}`)
        sendError(res, 'Too many requests, please slow down.', 429)
    }
})

/**
 * Auth verification limiter
 * - Max 10 attempts per IP per 15 menit
 * - Untuk endpoint verify password (settings access)
 */
export const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10,
    message: {
        status: 'error',
        message: 'Too many verification attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(`⚠️ [RATE LIMIT] Verify exceeded for IP: ${req.ip}`)
        sendError(res, 'Too many verification attempts. Please try again later.', 429)
    }
})
