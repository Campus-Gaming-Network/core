package models

import (
	"database/sql"
	"time"
)

type User struct {
	Id           int
	FullName     string `json:"full_name"`
	Email        string
	Gravatar     string
	PasswordHash string       `json:"password_hash"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
	DeletedAt    sql.NullTime `json:"deleted_at"`
}

// ToViewModel creates a view-model, UserVM, from a User
func (u *User) ToViewModel() UserVM {
	return UserVM{
		Id:        u.Id,
		FullName:  u.FullName,
		Email:     u.Email,
		Gravatar:  u.Gravatar,
		CreatedAt: u.CreatedAt,
		UpdatedAt: u.UpdatedAt,
		DeletedAt: u.DeletedAt,
	}
}

// UserVM is data from a User object to be used on the front-end
type UserVM struct {
	Id        int
	FullName  string `json:"full_name"`
	Email     string
	Gravatar  string
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
	DeletedAt sql.NullTime `json:"deleted_at"`
}
