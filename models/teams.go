package models

type Team struct {
	Id   int    `json:"id" driver:"id"`
	Name string `json:"name" driver:"name"`
}
