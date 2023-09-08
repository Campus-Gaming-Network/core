package logger

import (
	"log"
	"os"
)

// Logger contains the info and error logs
type Logger struct {
	InfoLog  *log.Logger
	ErrorLog *log.Logger
}

// logger is accessible within the app to log information
var logger *Logger

// InitLogger creates the info and error logs
func InitLogger() {
	infoLog := log.New(os.Stdout, "INFO\t", log.Ldate|log.Ltime)
	errorLog := log.New(os.Stdout, "ERROR\t", log.Ldate|log.Ltime|log.Lshortfile)

	logger = &Logger{
		InfoLog:  infoLog,
		ErrorLog: errorLog,
	}
}

// Error logs output to error log
func Error(a ...any) {
	logger.ErrorLog.Println(a...)
}

// FatalError logs output to error log and exits program
func FatalError(a ...any) {
	logger.ErrorLog.Println(a...)
	os.Exit(1)
}

// Log logs output to info log
func Log(a ...any) {
	logger.InfoLog.Println(a...)
}
